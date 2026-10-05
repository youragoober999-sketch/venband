// The sandbox panel: run the open file, pass stdin/args or a fake HTTP request,
// and see output. HTML and Markdown files get a live preview.
import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { Badge, Button, CopyButton, Icon, IconButton, Segmented } from './ui'
import { runInSandbox, looksLikeHandler } from '../lib/sandbox'
import type { RunResult, VFile } from '../lib/api'
import { languageForPath, isRunnable } from '../../shared/languages.js'
import { useApp } from '../lib/store'
import { t } from '../lib/i18n'
import { click, cx, speak } from '../lib/util'

export type SandboxHandle = { run: () => void }

type Props = { apiId: string; entry: string | null; files: VFile[] }

type Run = RunResult & { where: string; at: number; file: string; id: number }

function markdownToHtml(md: string) {
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)
  const lines = md.split('\n')
  let html = ''
  let inCode = false
  let inList = false
  for (const raw of lines) {
    if (raw.startsWith('```')) {
      html += inCode ? '</code></pre>' : '<pre><code>'
      inCode = !inCode
      continue
    }
    if (inCode) { html += esc(raw) + '\n'; continue }
    let line = esc(raw)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    const li = /^\s*[-*]\s+(.*)$/.exec(line)
    if (li) { if (!inList) { html += '<ul>'; inList = true } html += `<li>${li[1]}</li>`; continue }
    if (inList) { html += '</ul>'; inList = false }
    if (h) line = `<h${h[1].length}>${h[2]}</h${h[1].length}>`
    else if (line.trim()) line = `<p>${line}</p>`
    html += line
  }
  if (inList) html += '</ul>'
  return `<!doctype html><meta charset="utf-8"><style>body{font:16px/1.6 system-ui;padding:16px;max-width:760px;color:#1f2330}code{background:#eef;padding:2px 4px;border-radius:4px}pre{background:#f4f4fb;padding:12px;border-radius:8px;overflow:auto}</style>${html}`
}

export const Sandbox = forwardRef<SandboxHandle, Props>(function Sandbox({ apiId, entry, files }, ref) {
  const { settings, announce } = useApp()
  const [stdin, setStdin] = useState('')
  const [args, setArgs] = useState('')
  const [where, setWhere] = useState<'auto' | 'browser' | 'server'>('auto')
  const [asRequest, setAsRequest] = useState(false)
  const [reqMethod, setReqMethod] = useState('GET')
  const [reqQuery, setReqQuery] = useState('name=Vix')
  const [reqBody, setReqBody] = useState('{\n  "player": "ana",\n  "score": 1200\n}')
  const [running, setRunning] = useState(false)
  const [runs, setRuns] = useState<Run[]>([])
  const [view, setView] = useState<'output' | 'preview'>('output')
  const [showInputs, setShowInputs] = useState(false)
  const outRef = useRef<HTMLDivElement>(null)

  const lang = entry ? languageForPath(entry) : null
  const file = files.find((f) => f.path === entry)
  const previewable = !!lang && (lang.id === 'html' || lang.id === 'markdown' || lang.id === 'xml' && entry?.endsWith('.svg'))
  const handlerFile = !!file && lang?.runner === 'quickjs' && looksLikeHandler(file.content)
  const latest = runs[0]

  const srcDoc = useMemo(() => {
    if (!previewable || !file) return ''
    if (lang!.id === 'markdown') return markdownToHtml(file.content)
    return file.content
  }, [previewable, file, lang])

  async function run() {
    if (!entry || !file || running) return
    if (previewable && settings.extensions['live-preview']) {
      setView('preview')
      return
    }
    if (!isRunnable(lang)) {
      const msg = `${lang?.name} files can't be run, but they can be served by an endpoint${lang?.runner === 'static' ? ' as a static file' : ''}.`
      setRuns((r) => [{ stdout: lang?.runner === 'static' ? file.content : '', stderr: msg, exitCode: 0, durationMs: 0, engine: 'none', where: 'browser', at: Date.now(), file: entry, id: Date.now() }, ...r].slice(0, 15))
      return
    }
    setRunning(true)
    setView('output')
    announce(`Running ${entry}`)
    let request: Record<string, unknown> | null = null
    if (asRequest || (handlerFile && where !== 'browser')) {
      let body: unknown = null
      if (reqMethod !== 'GET' && reqBody.trim()) {
        try { body = JSON.parse(reqBody) } catch { body = reqBody }
      }
      request = { method: reqMethod, path: '/', query: Object.fromEntries(new URLSearchParams(reqQuery)), headers: { 'content-type': 'application/json' }, body, rawBody: reqBody, params: {}, ip: '127.0.0.1' }
    }
    try {
      const res = await runInSandbox({ entry, files, stdin, args: args.trim() ? args.match(/"[^"]*"|\S+/g)!.map((a) => a.replace(/^"|"$/g, '')) : [], apiId, request: (asRequest || handlerFile) && where !== 'browser' ? request : null, where })
      const r: Run = { ...res, at: Date.now(), file: entry, id: Date.now() }
      setRuns((prev) => [r, ...prev].slice(0, 15))
      const ok = r.exitCode === 0
      const summary = `${ok ? 'Finished' : 'Failed'} in ${r.durationMs} milliseconds${r.stdout ? `, ${r.stdout.split('\n').filter(Boolean).length} lines of output` : ''}${r.stderr ? ', with errors' : ''}`
      announce(settings.srVerbose ? `${summary}. ${(r.stdout || r.stderr).slice(0, 300)}` : summary)
      if (settings.sounds) ok ? click(880, 0.05, 0.12) : click(220, 0.06, 0.25)
      if (settings.extensions['speak-output']) speak(valueText(r) || r.stdout || r.stderr || summary)
      requestAnimationFrame(() => outRef.current?.scrollTo({ top: 0 }))
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setRuns((prev) => [{ stdout: '', stderr: msg, exitCode: 1, durationMs: 0, engine: 'error', where: 'server', at: Date.now(), file: entry, id: Date.now() } as Run, ...prev].slice(0, 15))
      announce(`Run failed: ${msg}`, true)
    } finally {
      setRunning(false)
    }
  }

  useImperativeHandle(ref, () => ({ run }))

  return (
    <section className="sandbox" aria-label="Sandbox">
      <div className="sandbox-bar">
        <Button variant="primary" size="sm" icon="play" onClick={run} loading={running} disabled={!entry} aria-keyshortcuts="Control+Enter">
          {running ? t('ws.running') : previewable && settings.extensions['live-preview'] ? 'Preview' : t('ws.run')}
        </Button>
        {lang && <Badge tone="neutral">{lang.name}</Badge>}
        {handlerFile && <Badge tone="accent">Endpoint handler</Badge>}
        <div className="sandbox-bar-right">
          {previewable && (
            <Segmented label="Panel" value={view} onChange={setView} options={[{ value: 'output', label: t('ws.output') }, { value: 'preview', label: 'Preview' }]} />
          )}
          <button type="button" className={cx('btn btn-ghost btn-sm', showInputs && 'pressed')} aria-expanded={showInputs} aria-controls="sandbox-inputs" onClick={() => setShowInputs((s) => !s)}>
            <Icon name="settings" size={14} /> Inputs
          </button>
          <IconButton icon="trash" label={t('ws.clear')} onClick={() => setRuns([])} />
        </div>
      </div>
      {showInputs && (
        <div id="sandbox-inputs" className="sandbox-inputs">
          {lang?.runner === 'quickjs' && (
            <div className="row-wrap">
              <span className="field-label">Run in</span>
              <Segmented label="Run location" value={where} onChange={setWhere} options={[{ value: 'auto', label: 'Auto' }, { value: 'browser', label: 'Browser' }, { value: 'server', label: 'Server (KV, fetch)' }]} />
            </div>
          )}
          <label className="check-row small">
            <input type="checkbox" checked={asRequest || handlerFile} disabled={handlerFile} onChange={(e) => setAsRequest(e.target.checked)} />
            Send a test HTTP request (as an endpoint would receive it)
          </label>
          {(asRequest || handlerFile) && (
            <div className="req-grid">
              <label>Method
                <select className="input" value={reqMethod} onChange={(e) => setReqMethod(e.target.value)}>{['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => <option key={m}>{m}</option>)}</select>
              </label>
              <label>Query string
                <input className="input mono" value={reqQuery} onChange={(e) => setReqQuery(e.target.value)} placeholder="a=1&b=2" spellCheck={false} />
              </label>
              {reqMethod !== 'GET' && (
                <label className="span-2">Body (JSON)
                  <textarea className="input mono" rows={4} value={reqBody} onChange={(e) => setReqBody(e.target.value)} spellCheck={false} />
                </label>
              )}
            </div>
          )}
          <div className="grid-2">
            <label>{t('ws.stdin')}
              <textarea className="input mono" rows={3} value={stdin} onChange={(e) => setStdin(e.target.value)} placeholder="Text your program reads from standard input" spellCheck={false} />
            </label>
            <label>{t('ws.args')}
              <input className="input mono" value={args} onChange={(e) => setArgs(e.target.value)} placeholder='arg1 "arg two"' spellCheck={false} />
            </label>
          </div>
        </div>
      )}
      {view === 'preview' && previewable ? (
        <iframe className="preview-frame" title={`Preview of ${entry}`} sandbox="allow-scripts allow-forms allow-modals" srcDoc={srcDoc} />
      ) : (
        <div className="sandbox-out" ref={outRef}>
          {!latest ? (
            <p className="hint sandbox-empty">
              <Icon name="terminal" /> Press <kbd className="kbd">Ctrl</kbd> + <kbd className="kbd">Enter</kbd> to run the open file.
              {lang && lang.runner === 'remote' && ' This language compiles on the server and may take a few seconds.'}
            </p>
          ) : (
            <div role="log" aria-label={`${t('ws.output')} of ${latest.file}`} aria-live="off">
              {runs.map((r, i) => (
                <article key={r.id} className={cx('run', i > 0 && 'run-old')} aria-label={`Run of ${r.file}`}>
                  <header className="run-head">
                    <Badge tone={r.exitCode === 0 ? 'good' : 'bad'}>
                      <Icon name={r.exitCode === 0 ? 'check' : 'alert'} size={12} /> {r.exitCode === 0 ? 'Success' : `Exit ${r.exitCode}`}
                    </Badge>
                    <span className="hint">{r.file} · {r.durationMs} ms · {r.engine}{r.where === 'browser' ? ' · in your browser' : ''}</span>
                    <span className="run-copy"><CopyButton text={[valueText(r), r.stdout, r.stderr].filter(Boolean).join('\n')} /></span>
                  </header>
                  {r.compileOutput && <pre className="out out-compile">{r.compileOutput}</pre>}
                  {r.stdout && <pre className="out">{r.stdout}</pre>}
                  {r.hasHandler && r.value !== undefined && (
                    <>
                      <div className="out-label">Response</div>
                      <pre className="out out-value">{valueText(r)}</pre>
                    </>
                  )}
                  {r.stderr && <pre className="out out-err">{r.stderr}</pre>}
                  {!r.stdout && !r.stderr && !r.hasHandler && <p className="hint">(no output)</p>}
                </article>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  )
})

function valueText(r: RunResult) {
  if (!r.hasHandler) return ''
  try {
    return typeof r.value === 'string' ? r.value : JSON.stringify(r.value, null, 2)
  } catch {
    return String(r.value)
  }
}
