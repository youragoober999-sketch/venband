import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runQuickJS, runFile, toResponse, transformJs, pickWandboxCompiler } from '../api/_lib/exec.js'
import { languageById } from '../shared/languages.js'

test('script mode captures console output', async () => {
  const r = await runQuickJS({ code: 'console.log("hi", {a: 1}); console.error("bad")', mode: 'script' })
  assert.equal(r.exitCode, 0)
  assert.equal(r.stdout, 'hi {\n  "a": 1\n}\n')
  assert.equal(r.stderr, 'bad')
})

test('handler mode with kv host calls', async () => {
  const store = new Map()
  const host = async (name, arg) => {
    if (name === 'kv.get') return store.get(arg.key) ?? null
    if (name === 'kv.set') { store.set(arg.key, arg.value); return true }
    throw new Error('nope')
  }
  const code = `export default async function (req) { const n = ((await vix.kv.get('n')) || 0) + 1; await vix.kv.set('n', n); return { status: 201, body: { n, q: req.query.x, secret: vix.env.TOKEN } } }`
  const r1 = await runQuickJS({ code, request: { query: { x: '1' } }, host, env: { TOKEN: 't' } })
  const r2 = await runQuickJS({ code, request: { query: { x: '2' } }, host, env: { TOKEN: 't' } })
  assert.deepEqual(toResponse(r2), { status: 201, headers: {}, body: { n: 2, q: '2', secret: 't' } })
  assert.equal(r1.value.body.n, 1)
})

test('infinite loops are interrupted', async () => {
  const r = await runQuickJS({ code: 'while (true) {}', mode: 'script', timeoutMs: 300 })
  assert.equal(r.exitCode, 1)
  assert.match(r.error, /ran longer/)
})

test('no access to node internals', async () => {
  const r = await runQuickJS({ code: 'console.log(typeof process, typeof require, typeof globalThis.__dirname)', mode: 'script' })
  assert.equal(r.stdout.trim(), 'undefined undefined undefined')
})

test('top level await in scripts', async () => {
  const r = await runQuickJS({ code: 'await vix.sleep(5); console.log("after")', mode: 'script' })
  assert.equal(r.stdout.trim(), 'after')
})

test('syntax errors are reported', async () => {
  const r = await runQuickJS({ code: 'function (', mode: 'script' })
  assert.equal(r.exitCode, 1)
  assert.match(r.stderr, /SyntaxError/)
})

test('rejected handler gives 500', async () => {
  const r = await runQuickJS({ code: 'async function handler() { throw new Error("boom") }', request: {} })
  const res = toResponse(r)
  assert.equal(res.status, 500)
  assert.match(res.body.detail, /boom/)
})

test('batch endpoint via runFile', async () => {
  const files = [{ path: 'api.bat', content: languageById('batch').endpoint }]
  const r = await runFile({ entry: 'api.bat', files, request: { method: 'GET', path: '/', query: { name: 'Ann' } } })
  assert.deepEqual(toResponse(r).body, { message: 'Hello from Batch, Ann!' })
})

test('default JavaScript template works', async () => {
  const kv = new Map()
  const host = async (n, a) => (n === 'kv.get' ? kv.get(a.key) ?? null : (kv.set(a.key, a.value), true))
  const files = [{ path: 'index.js', content: languageById('javascript').endpoint }]
  const r = await runFile({ entry: 'index.js', files, request: { method: 'GET', query: { name: 'Zed' } }, host })
  const res = toResponse(r)
  assert.equal(res.status, 200)
  assert.equal(res.body.message, 'Hello, Zed!')
  assert.equal(res.body.visits, 1)
})

test('static files', async () => {
  const r = await runFile({ entry: 'data.json', files: [{ path: 'data.json', content: '{"a":1}' }] })
  assert.deepEqual(toResponse(r), { status: 200, headers: { 'content-type': 'application/json' }, body: '{"a":1}' })
})

test('transformJs strips exports', () => {
  assert.equal(transformJs('export const a = 1\nexport function b() {}'), 'const a = 1\nfunction b() {}')
})

test('wandbox compiler choice prefers newest stable', () => {
  const list = [
    { name: 'cpython-head', language: 'Python', version: '3.14.0a' },
    { name: 'cpython-3.12.7', language: 'Python', version: '3.12.7' },
    { name: 'cpython-3.13.0', language: 'Python', version: '3.13.0' },
    { name: 'pypy-3.10', language: 'Python', version: '3.10' },
  ]
  assert.equal(pickWandboxCompiler(list, languageById('python')).name, 'cpython-3.13.0')
})
