// Code execution engines.
//
//   JavaScript -> QuickJS compiled to WebAssembly, in-process. The VM has no
//                 access to Node, the filesystem, the network or environment
//                 variables (so it can never see the Supabase secret). Memory
//                 and CPU time are capped. fetch, a KV store and secrets are
//                 offered through narrow, audited host functions.
//   Batch      -> the JavaScript batch interpreter in shared/batch.js.
//   Everything else (Python, Rust, Java, C#, C/C++, Go, Lua, Ruby, PHP, ...)
//              -> a remote sandbox: your own Piston server when PISTON_URL is
//                 set, otherwise the free public Wandbox service.
import { getQuickJS, shouldInterruptAfterDeadline } from 'quickjs-emscripten'
import { randomUUID } from 'node:crypto'
import { runBatch } from '../../shared/batch.js'
import { languageForPath, languageById } from '../../shared/languages.js'

let quickjsPromise = null
const quickjs = () => (quickjsPromise ||= getQuickJS())

const MAX_LOG = 64 * 1024

function formatLogValue(v) {
  if (typeof v === 'string') return v
  if (v === undefined) return 'undefined'
  if (v && typeof v === 'object' && typeof v.message === 'string' && typeof v.name === 'string') return `${v.name}: ${v.message}`
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return String(v)
  }
}

// Runs inside the VM before user code.
const PRELUDE = `
const __call = async (name, arg) => JSON.parse(await __host(name, JSON.stringify(arg === undefined ? null : arg)));
globalThis.console = {
  log: (...a) => __log('log', ...a), info: (...a) => __log('info', ...a), debug: (...a) => __log('debug', ...a),
  warn: (...a) => __log('warn', ...a), error: (...a) => __log('error', ...a),
  table: (t) => __log('log', t), dir: (o) => __log('log', o), time() {}, timeEnd() {}, assert: (c, ...a) => { if (!c) __log('error', 'Assertion failed', ...a) },
};
globalThis.module = { exports: {} };
globalThis.exports = globalThis.module.exports;
const __b64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
globalThis.btoa = (s) => { s = String(s); let o = ''; for (let i = 0; i < s.length; i += 3) { const n = (s.charCodeAt(i) << 16) | ((s.charCodeAt(i + 1) || 0) << 8) | (s.charCodeAt(i + 2) || 0); o += __b64[(n >> 18) & 63] + __b64[(n >> 12) & 63] + (i + 1 < s.length ? __b64[(n >> 6) & 63] : '=') + (i + 2 < s.length ? __b64[n & 63] : '='); } return o; };
globalThis.atob = (s) => { s = String(s).replace(/=+$/, ''); let o = '', b = 0, n = 0; for (const c of s) { b = (b << 6) | __b64.indexOf(c); n += 6; if (n >= 8) { n -= 8; o += String.fromCharCode((b >> n) & 255); } } return o; };
globalThis.crypto = { randomUUID: () => __uuid(), getRandomValues: (arr) => { for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256); return arr; } };
globalThis.setTimeout = (fn, ms, ...args) => { __call('sleep', { ms: Number(ms) || 0 }).then(() => fn(...args)); return 0; };
globalThis.clearTimeout = () => {};
globalThis.fetch = async (url, opts = {}) => {
  const r = await __call('fetch', { url: String(url), method: opts.method, headers: opts.headers, body: opts.body });
  return { ok: r.ok, status: r.status, url: r.url, headers: { get: (n) => r.headers[String(n).toLowerCase()] ?? null, entries: () => Object.entries(r.headers) },
    text: async () => r.body, json: async () => JSON.parse(r.body) };
};
globalThis.vix = {
  env: Object.freeze(JSON.parse(__ENV)),
  kv: {
    get: (key) => __call('kv.get', { key: String(key) }),
    set: (key, value) => __call('kv.set', { key: String(key), value }),
    delete: (key) => __call('kv.delete', { key: String(key) }),
    list: (prefix = '') => __call('kv.list', { prefix: String(prefix) }),
    increment: (key, by = 1) => __call('kv.incr', { key: String(key), by: Number(by) || 1 }),
  },
  fetch: globalThis.fetch,
  uuid: () => __uuid(),
  sleep: (ms) => __call('sleep', { ms: Number(ms) || 0 }),
  json: (body, status = 200, headers = {}) => ({ status, headers: { 'content-type': 'application/json', ...headers }, body }),
  text: (body, status = 200, headers = {}) => ({ status, headers: { 'content-type': 'text/plain; charset=utf-8', ...headers }, body: String(body) }),
  html: (body, status = 200, headers = {}) => ({ status, headers: { 'content-type': 'text/html; charset=utf-8', ...headers }, body: String(body) }),
  redirect: (location, status = 302) => ({ status, headers: { location }, body: '' }),
};
globalThis.__vixFind = () => {
  const m = globalThis.module.exports;
  return globalThis.__vixDefault || (typeof m === 'function' ? m : null) || (m && (m.handler || m.default)) ||
    (typeof globalThis.handler === 'function' ? globalThis.handler : null) || (typeof globalThis.main === 'function' ? globalThis.main : null);
};
`

/** Turns ESM-style exports into plain script code the VM can evaluate. */
export function transformJs(code) {
  return String(code)
    .replace(/^\s*import\s+[^;\n]*from\s+['"][^'"]+['"];?\s*$/gm, (m) => `/* ${m.trim().replace(/\*\//g, '')} (imports are not available in the hosted runtime) */`)
    .replace(/\bexport\s+default\s+/g, 'globalThis.__vixDefault = ')
    .replace(/\bexport\s+(async\s+function|function|const|let|var|class)\b/g, '$1')
    .replace(/^\s*export\s*\{[^}]*\};?\s*$/gm, '')
}

/**
 * Runs JavaScript in QuickJS.
 * @param {object} o
 * @param {string} o.code
 * @param {'script'|'handler'|'auto'} o.mode  script: run top to bottom. handler: call handler(req, ctx). auto: handler if one is defined.
 * @param {object} [o.request]
 * @param {Record<string,string>} [o.env]
 * @param {(name: string, arg: any) => Promise<any>} [o.host]
 * @param {number} [o.timeoutMs]
 */
export async function runQuickJS({ code, mode = 'auto', request = null, ctx = {}, env = {}, host, timeoutMs = 5000, filename = 'main.js' }) {
  const started = Date.now()
  const QuickJS = await quickjs()
  const runtime = QuickJS.newRuntime()
  runtime.setMemoryLimit(64 * 1024 * 1024)
  runtime.setMaxStackSize(1024 * 1024)
  const deadline = Date.now() + timeoutMs
  runtime.setInterruptHandler(shouldInterruptAfterDeadline(deadline))
  const vm = runtime.newContext()
  const logs = []
  let logSize = 0
  const pending = new Set()
  const out = { stdout: '', stderr: '', exitCode: 0, value: undefined, hasHandler: false, logs, engine: 'quickjs' }

  const pushLog = (level, text) => {
    if (logSize > MAX_LOG) return
    logSize += text.length
    logs.push({ level, text: logSize > MAX_LOG ? text.slice(0, 200) + '\n[output truncated]' : text })
  }

  try {
    const logFn = vm.newFunction('__log', (levelH, ...argHandles) => {
      const level = vm.getString(levelH)
      pushLog(level, argHandles.map((h) => formatLogValue(vm.dump(h))).join(' '))
    })
    vm.setProp(vm.global, '__log', logFn)
    logFn.dispose()

    const uuidFn = vm.newFunction('__uuid', () => vm.newString(randomUUID()))
    vm.setProp(vm.global, '__uuid', uuidFn)
    uuidFn.dispose()

    const envH = vm.newString(JSON.stringify(env || {}))
    vm.setProp(vm.global, '__ENV', envH)
    envH.dispose()

    const hostFn = vm.newFunction('__host', (nameH, argH) => {
      const name = vm.getString(nameH)
      let arg = null
      try {
        arg = JSON.parse(vm.getString(argH))
      } catch {}
      const deferred = vm.newPromise()
      pending.add(deferred)
      const call = name === 'sleep'
        ? new Promise((r) => setTimeout(() => r(null), Math.min(Math.max(0, arg?.ms || 0), Math.max(0, deadline - Date.now()))))
        : host ? Promise.resolve().then(() => host(name, arg)) : Promise.reject(new Error(`${name} is not available here`))
      call.then(
        (value) => {
          if (!vm.alive || !pending.has(deferred)) return
          const h = vm.newString(JSON.stringify(value === undefined ? null : value))
          deferred.resolve(h)
          h.dispose()
        },
        (err) => {
          if (!vm.alive || !pending.has(deferred)) return
          const h = vm.newError(String(err && err.message ? err.message : err))
          deferred.reject(h)
          h.dispose()
        },
      ).finally(() => {
        pending.delete(deferred)
        if (vm.alive) {
          deferred.dispose()
          runtime.executePendingJobs()
        }
      })
      return deferred.handle
    })
    vm.setProp(vm.global, '__host', hostFn)
    hostFn.dispose()

    const pre = vm.evalCode(PRELUDE, 'prelude.js')
    if (pre.error) {
      const e = vm.dump(pre.error)
      pre.error.dispose()
      throw new Error('Runtime prelude failed: ' + formatLogValue(e))
    }
    pre.value.dispose()

    let source = transformJs(code)
    let evaluated = vm.evalCode(source, filename)
    if (evaluated.error) {
      const e = vm.dump(evaluated.error)
      evaluated.error.dispose()
      // Top-level await: retry the script inside an async function.
      if (/await|reserved word|expecting ';'/i.test(formatLogValue(e)) && /\bawait\b/.test(source)) {
        evaluated = vm.evalCode(`globalThis.__vixTop = (async () => {\n${source}\n})();`, filename)
        if (evaluated.error) {
          const e2 = vm.dump(evaluated.error)
          evaluated.error.dispose()
          throw Object.assign(new Error(formatErr(e2)), { user: true })
        }
      } else throw Object.assign(new Error(formatErr(e)), { user: true })
    }
    evaluated.value.dispose()

    const reqJson = JSON.stringify(request || {})
    const ctxJson = JSON.stringify(ctx || {})
    const driver = `(async () => {
      if (globalThis.__vixTop) await globalThis.__vixTop;
      const h = __vixFind();
      const wantHandler = ${JSON.stringify(mode)} !== 'script';
      if (!h || !wantHandler) return JSON.stringify({ hasHandler: !!h, value: null });
      const v = await h(Object.freeze(${reqJson}), ${ctxJson});
      return JSON.stringify({ hasHandler: true, value: v === undefined ? null : v });
    })()`
    const run = vm.evalCode(driver, 'vix-driver.js')
    if (run.error) {
      const e = vm.dump(run.error)
      run.error.dispose()
      throw Object.assign(new Error(formatErr(e)), { user: true })
    }
    const native = vm.resolvePromise(run.value)
    run.value.dispose()
    runtime.executePendingJobs()
    let timer
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error(`Timed out after ${timeoutMs / 1000}s`), { user: true })), Math.max(0, deadline - Date.now()))
    })
    const settled = await Promise.race([native, timeout]).finally(() => clearTimeout(timer))
    if (settled.error) {
      const e = vm.dump(settled.error)
      settled.error.dispose()
      throw Object.assign(new Error(formatErr(e)), { user: true })
    }
    const result = JSON.parse(vm.getString(settled.value))
    settled.value.dispose()
    out.hasHandler = result.hasHandler
    out.value = result.value
  } catch (err) {
    out.exitCode = 1
    const msg = err && err.message ? err.message : String(err)
    out.error = /interrupted/i.test(msg) ? `Stopped: the code ran longer than ${timeoutMs / 1000}s (infinite loop?)` : /out of memory/i.test(msg) ? 'Stopped: the code used more than 64 MB of memory' : msg
    pushLog('error', out.error)
  } finally {
    for (const d of pending) {
      try {
        d.dispose()
      } catch {}
    }
    pending.clear()
    try {
      vm.dispose()
      runtime.dispose()
    } catch {
      // A leaked handle poisons the shared module, so start a fresh one next time.
      quickjsPromise = null
    }
  }
  out.stdout = logs.filter((l) => l.level !== 'error' && l.level !== 'warn').map((l) => l.text).join('\n') + (logs.length ? '\n' : '')
  out.stderr = logs.filter((l) => l.level === 'error' || l.level === 'warn').map((l) => l.text).join('\n')
  out.durationMs = Date.now() - started
  return out
}

function formatErr(e) {
  if (e && typeof e === 'object') {
    const head = `${e.name || 'Error'}: ${e.message ?? ''}`
    return e.stack ? `${head}\n${String(e.stack).trim()}` : head
  }
  return String(e)
}

// ---------------------------------------------------------------- remote ----

let wandboxCache = { at: 0, list: null }

async function wandboxCompilers(base) {
  if (wandboxCache.list && Date.now() - wandboxCache.at < 3600_000) return wandboxCache.list
  const r = await fetch(`${base}/api/list.json`, { signal: AbortSignal.timeout(8000) })
  if (!r.ok) throw new Error(`Wandbox list failed (${r.status})`)
  const list = await r.json()
  wandboxCache = { at: Date.now(), list }
  return list
}

function versionKey(v) {
  return String(v || '').split(/[^0-9]+/).filter(Boolean).slice(0, 4).map((n) => n.padStart(6, '0')).join('.')
}

export function pickWandboxCompiler(list, lang) {
  const wanted = (lang.wandbox || []).map((s) => s.toLowerCase())
  const matches = list.filter((c) => wanted.includes(String(c.language).toLowerCase()))
  if (!matches.length) return null
  const stable = matches.filter((c) => !/head|snapshot|dev|nightly/i.test(c.name))
  const pool = stable.length ? stable : matches
  // Prefer the mainstream toolchain when several exist (gcc over clang, cpython over pypy, ...).
  const prefer = { c: /^gcc/, cpp: /^gcc/, python: /^cpython/, javascript: /^nodejs/, csharp: /^dotnetcore|^mono/, ruby: /^ruby/ }
  const preferred = prefer[lang.id] ? pool.filter((c) => prefer[lang.id].test(c.name)) : []
  const finalPool = preferred.length ? preferred : pool
  return finalPool.sort((a, b) => (versionKey(b.version) > versionKey(a.version) ? 1 : -1))[0]
}

function javaForWandbox(code) {
  const src = code.replace(/^(\s*)public\s+((?:final\s+|abstract\s+)?class\s)/gm, '$1$2')
  const main = /class\s+(\w+)[^{]*\{[\s\S]*?static\s+void\s+main\s*\(/.exec(src)
  if (main && main[1] !== 'prog') return `${src}\nclass prog { public static void main(String[] a) throws Exception { ${main[1]}.main(a); } }\n`
  return src
}

async function runWandbox({ lang, entryCode, extraFiles, stdin, args, timeoutMs }) {
  const base = (process.env.WANDBOX_URL || 'https://wandbox.org').replace(/\/+$/, '')
  const list = await wandboxCompilers(base)
  const compiler = pickWandboxCompiler(list, lang)
  if (!compiler) throw new Error(`${lang.name} is not available on the Wandbox runner. Set PISTON_URL to use your own Piston server.`)
  const code = lang.id === 'java' ? javaForWandbox(entryCode) : entryCode
  const body = {
    compiler: compiler.name,
    code,
    codes: extraFiles.map((f) => ({ file: f.name, code: f.content })),
    stdin: stdin || '',
    options: '',
    'compiler-option-raw': '',
    'runtime-option-raw': (args || []).join('\n'),
    save: false,
  }
  const r = await fetch(`${base}/api/compile.json`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs + 15000),
  })
  if (!r.ok) throw new Error(`The ${lang.name} runner is busy (HTTP ${r.status}). Try again in a moment.`)
  const j = await r.json()
  return {
    stdout: j.program_output || '',
    stderr: [j.compiler_error, j.program_error].filter(Boolean).join('\n'),
    compileOutput: j.compiler_message || '',
    exitCode: j.signal ? 137 : parseInt(j.status ?? '0', 10) || 0,
    engine: `wandbox:${compiler.name}`,
  }
}

async function runPiston({ lang, entryName, entryCode, extraFiles, stdin, args, timeoutMs }) {
  const base = process.env.PISTON_URL.replace(/\/+$/, '')
  const headers = { 'content-type': 'application/json' }
  if (process.env.PISTON_TOKEN) headers.authorization = process.env.PISTON_TOKEN
  const r = await fetch(`${base}/api/v2/execute`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      language: lang.piston,
      version: '*',
      files: [{ name: entryName, content: entryCode }, ...extraFiles.map((f) => ({ name: f.name, content: f.content }))],
      stdin: stdin || '',
      args: args || [],
      run_timeout: timeoutMs,
      compile_timeout: 15000,
    }),
    signal: AbortSignal.timeout(timeoutMs + 20000),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.message || `The ${lang.name} runner failed (HTTP ${r.status})`)
  const compileFailed = j.compile && j.compile.code
  return {
    stdout: compileFailed ? '' : j.run?.stdout || '',
    stderr: compileFailed ? j.compile.stderr || j.compile.output : j.run?.stderr || '',
    compileOutput: j.compile?.stdout || '',
    exitCode: compileFailed ? j.compile.code : j.run?.code ?? (j.run?.signal ? 137 : 0),
    engine: `piston:${j.language}@${j.version}`,
  }
}

/**
 * Runs any supported file.
 * @param {object} o
 * @param {string} o.entry        path of the file to run
 * @param {{path: string, content: string, is_folder?: boolean}[]} o.files  all project files
 * @param {string} [o.stdin]
 * @param {string[]} [o.args]
 * @param {object} [o.request]    hosted request (for handler mode / batch env)
 * @param {Record<string,string>} [o.env]
 * @param {Function} [o.host]
 * @param {'script'|'handler'|'auto'} [o.mode]
 * @param {number} [o.timeoutMs]
 */
export async function runFile({ entry, files, stdin = '', args = [], request = null, env = {}, host, mode = 'auto', timeoutMs = 8000, language }) {
  const started = Date.now()
  const file = files.find((f) => f.path === entry && !f.is_folder)
  if (!file) return { stdout: '', stderr: `File not found: ${entry}`, exitCode: 1, durationMs: 0, engine: 'none' }
  const lang = (language && languageById(language)) || languageForPath(entry)

  if (lang.runner === 'quickjs') {
    return runQuickJS({ code: file.content, mode, request, env, host, timeoutMs: Math.min(timeoutMs, 10000), filename: entry })
  }

  if (lang.runner === 'batch') {
    const vars = { ...env }
    if (request) Object.assign(vars, requestEnv(request))
    const virtualFiles = {}
    for (const f of files) if (!f.is_folder) virtualFiles[f.path] = f.content
    const r = runBatch(file.content, { stdin: stdin || (request ? JSON.stringify(request) : ''), env: vars, files: virtualFiles, args })
    return { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode, durationMs: Date.now() - started, engine: 'vix-batch' }
  }

  if (lang.runner === 'remote') {
    const dir = entry.includes('/') ? entry.slice(0, entry.lastIndexOf('/') + 1) : ''
    const extraFiles = files
      .filter((f) => !f.is_folder && f.path !== entry && f.path.startsWith(dir) && !f.path.slice(dir.length).includes('/') && f.content.length < 200_000)
      .filter((f) => languageForPath(f.path).id === lang.id || /\.(txt|json|csv|h|hpp)$/i.test(f.path))
      .slice(0, 20)
      .map((f) => ({ name: f.path.slice(dir.length), content: f.content }))
    const entryName = entry.slice(dir.length)
    const input = stdin || (request ? JSON.stringify(request) : '')
    try {
      const r = process.env.PISTON_URL
        ? await runPiston({ lang, entryName, entryCode: file.content, extraFiles, stdin: input, args, timeoutMs })
        : await runWandbox({ lang, entryCode: file.content, extraFiles, stdin: input, args, timeoutMs })
      return { ...r, durationMs: Date.now() - started }
    } catch (e) {
      const msg = e && e.name === 'TimeoutError' ? `The ${lang.name} runner did not answer in time.` : e.message
      return { stdout: '', stderr: msg, exitCode: 1, durationMs: Date.now() - started, engine: 'remote' }
    }
  }

  if (lang.runner === 'static') {
    return { stdout: file.content, stderr: '', exitCode: 0, durationMs: 0, engine: 'static', staticMime: lang.mime }
  }
  return { stdout: '', stderr: `${lang.name} files can be edited and saved, but not run. Try JavaScript, Python, Rust, Batch or one of the other ${''}runnable languages.`, exitCode: 1, durationMs: 0, engine: 'none' }
}

/** Request details as environment variables (used by Batch). */
export function requestEnv(request) {
  const env = {
    VIX_METHOD: request.method || 'GET',
    VIX_PATH: request.path || '/',
    VIX_BODY: typeof request.body === 'string' ? request.body : request.body == null ? '' : JSON.stringify(request.body),
    VIX_QUERY: new URLSearchParams(request.query || {}).toString(),
    VIX_IP: request.ip || '',
  }
  for (const [k, v] of Object.entries(request.query || {})) env[`QUERY_${k.replace(/[^A-Za-z0-9_]/g, '_')}`] = String(v)
  for (const [k, v] of Object.entries(request.params || {})) env[`PARAM_${k.replace(/[^A-Za-z0-9_]/g, '_')}`] = String(v)
  for (const [k, v] of Object.entries(request.headers || {})) env[`HEADER_${k.replace(/[^A-Za-z0-9_]/g, '_').toUpperCase()}`] = String(v)
  return env
}

/**
 * Turns runner output into an HTTP response.
 * stdout that is JSON like {"status":200,"headers":{},"body":...} is used as-is,
 * other JSON is returned as JSON, anything else as text.
 */
export function toResponse(result) {
  if (result.staticMime) return { status: 200, headers: { 'content-type': result.staticMime }, body: result.stdout }
  if (result.engine === 'quickjs') {
    if (result.exitCode !== 0) return { status: 500, headers: {}, body: { error: 'Endpoint crashed', detail: result.error || result.stderr } }
    if (!result.hasHandler) {
      return { status: 500, headers: {}, body: { error: 'No handler found', detail: 'Define `async function handler(req, ctx) { ... }` or `export default` a function.' } }
    }
    return normalizeValue(result.value)
  }
  const text = (result.stdout || '').trim()
  if (!text && result.exitCode !== 0) return { status: 500, headers: {}, body: { error: 'Endpoint crashed', detail: (result.stderr || '').slice(0, 4000), exitCode: result.exitCode } }
  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      return normalizeValue(JSON.parse(text))
    } catch {}
  }
  return { status: result.exitCode === 0 ? 200 : 500, headers: { 'content-type': 'text/plain; charset=utf-8' }, body: result.stdout || '' }
}

function normalizeValue(v) {
  if (typeof v === 'string') return { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' }, body: v }
  if (v && typeof v === 'object' && !Array.isArray(v) && Number.isInteger(v.status) && ('body' in v || 'headers' in v)) {
    const status = v.status >= 100 && v.status <= 599 ? v.status : 200
    const headers = {}
    for (const [k, val] of Object.entries(v.headers || {})) headers[String(k).toLowerCase()] = String(val)
    return { status, headers, body: v.body ?? '' }
  }
  return { status: 200, headers: {}, body: v }
}
