// The built-in sandbox. Batch and plain JavaScript scripts run right in the
// browser (instant, works offline); endpoint handlers and every other language
// run on the server with the same engines the live API uses.
import { runBatch } from '../../shared/batch.js'
import { languageForPath } from '../../shared/languages.js'
import { api, type RunResult, type VFile } from './api'

export type RunRequest = {
  entry: string
  files: VFile[]
  stdin?: string
  args?: string[]
  apiId?: string
  request?: Record<string, unknown> | null
  where?: 'auto' | 'browser' | 'server'
}

const WORKER_SRC = `
const send = (level, args) => {
  const text = args.map((a) => {
    if (typeof a === 'string') return a
    if (a instanceof Error) return a.name + ': ' + a.message
    try { return JSON.stringify(a, null, 2) } catch { return String(a) }
  }).join(' ')
  postMessage({ type: 'log', level, text })
}
self.console = { log: (...a) => send('log', a), info: (...a) => send('info', a), warn: (...a) => send('warn', a), error: (...a) => send('error', a), debug: (...a) => send('debug', a), table: (t) => send('log', [t]) }
self.vix = { env: {}, kv: { get: async () => null, set: async () => true, delete: async () => true, list: async () => [] }, uuid: () => crypto.randomUUID(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) }
self.onmessage = async (e) => {
  const { code, stdin, args } = e.data
  self.stdin = stdin
  self.args = args
  try {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
    const src = code.replace(/\\bexport\\s+default\\s+/g, 'self.__default = ').replace(/\\bexport\\s+(async\\s+function|function|const|let|var|class)\\b/g, '$1')
    await new AsyncFunction('stdin', 'args', src)(stdin, args)
    postMessage({ type: 'done', code: 0 })
  } catch (err) {
    send('error', [err && err.stack ? String(err.stack) : String(err)])
    postMessage({ type: 'done', code: 1 })
  }
}
`

let workerUrl: string | null = null

function runJsInWorker(code: string, stdin: string, args: string[], timeoutMs = 10000): Promise<RunResult> {
  workerUrl ||= URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }))
  const started = performance.now()
  return new Promise((resolve) => {
    const w = new Worker(workerUrl!)
    const logs: { level: string; text: string }[] = []
    let finished = false
    const finish = (exitCode: number, extra = '') => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      w.terminate()
      if (extra) logs.push({ level: 'error', text: extra })
      resolve({
        stdout: logs.filter((l) => l.level !== 'error' && l.level !== 'warn').map((l) => l.text).join('\n') + (logs.length ? '\n' : ''),
        stderr: logs.filter((l) => l.level === 'error' || l.level === 'warn').map((l) => l.text).join('\n'),
        exitCode,
        durationMs: Math.round(performance.now() - started),
        engine: 'browser',
        logs,
      })
    }
    const timer = setTimeout(() => finish(1, `Stopped: the code ran longer than ${timeoutMs / 1000}s (infinite loop?)`), timeoutMs)
    w.onmessage = (e) => {
      if (e.data.type === 'log') {
        if (logs.length < 5000) logs.push({ level: e.data.level, text: e.data.text })
      } else if (e.data.type === 'done') finish(e.data.code)
    }
    w.onerror = (e) => finish(1, e.message)
    w.postMessage({ code, stdin, args })
  })
}

export function looksLikeHandler(code: string) {
  return /\b(async\s+)?function\s+handler\b|export\s+default|module\.exports/.test(code)
}

export async function runInSandbox(r: RunRequest): Promise<RunResult & { where: 'browser' | 'server' }> {
  const file = r.files.find((f) => f.path === r.entry)
  if (!file) throw new Error('File not found')
  const lang = languageForPath(r.entry)
  const where = r.where || 'auto'

  if (lang.runner === 'batch' && where !== 'server' && !r.request) {
    const started = performance.now()
    const vfs: Record<string, string> = {}
    for (const f of r.files) if (!f.is_folder) vfs[f.path] = f.content
    const out = runBatch(file.content, { stdin: r.stdin, args: r.args, files: vfs })
    return { stdout: out.stdout, stderr: out.stderr, exitCode: out.exitCode, durationMs: Math.round(performance.now() - started), engine: 'vix-batch (browser)', where: 'browser' }
  }

  if (lang.runner === 'quickjs' && (where === 'browser' || (where === 'auto' && !r.request && !looksLikeHandler(file.content)))) {
    const out = await runJsInWorker(file.content, r.stdin || '', r.args || [])
    return { ...out, where: 'browser' }
  }

  const res = await api.post<RunResult>('/exec', {
    api_id: r.apiId,
    entry: r.entry,
    files: r.files.filter((f) => !f.is_folder).map((f) => ({ path: f.path, content: f.content })),
    stdin: r.stdin,
    args: r.args,
    request: r.request || undefined,
  })
  return { ...res, where: 'server' }
}
